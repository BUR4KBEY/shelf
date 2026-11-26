// Command shelf pushes files and folders to a shelf server and manages the docs there.
package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"text/tabwriter"
	"time"
	"unicode"
)

var version = "dev"

func init() {
	// `go install …@v1.2.3` builds without the release's -ldflags; the module version is the same tag.
	if info, ok := debug.ReadBuildInfo(); ok && version == "dev" && strings.HasPrefix(info.Main.Version, "v") {
		version = strings.TrimPrefix(info.Main.Version, "v")
	}
}

const usage = `shelf shares files and folders from your own shelf server.

Usage:
  shelf login
  shelf push <file|dir> [--slug s] [--password p | --password-stdin] [--expires 7d|never]
                        [--title t] [--project p] [-m msg] [--new] [--json]
  shelf ls [--project p] [--json]
  shelf set <ref> [--slug s | --no-slug] [--password p | --password-stdin | --no-password]
                  [--expires 7d|never] [--title t] [--project p] [--fav | --unfav] [--json]
  shelf rm <ref>
  shelf open <ref>
  shelf get <url> [-o path] [--password p | --password-stdin]
  shelf version
  shelf help

A ref is a doc id or slug. --expires takes a duration in m, h, d or w, up to the
owner's limit (30d unless changed in the dashboard); 0 or never means the link never
expires. --project groups docs inside your key's space (a new version keeps the doc's
project; --project '' removes it). SHELF_URL and SHELF_KEY override the saved login.

Source, issues and releases: https://github.com/BUR4KBEY/shelf (a star helps others find it)
`

func main() {
	err := run(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		fmt.Print(usage)
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "shelf:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return flag.ErrHelp
	}
	cmd, args := args[0], args[1:]
	switch cmd {
	case "login":
		return login(args)
	case "push":
		return push(args)
	case "ls":
		return ls(args)
	case "set":
		return set(args)
	case "rm":
		return rm(args)
	case "open":
		return open(args)
	case "get":
		return get(args)
	case "version", "--version":
		fmt.Println("shelf", version, "· https://github.com/BUR4KBEY/shelf")
		return nil
	case "help", "-h", "--help":
		return flag.ErrHelp
	}
	return fmt.Errorf("unknown command %q (see shelf help)", cmd)
}

// parse parses flags that may come before, between or after the positionals,
// and checks the positional count.
func parse(fl *flag.FlagSet, args []string, npos int) ([]string, error) {
	fl.SetOutput(io.Discard)
	var pos []string
	for {
		if err := fl.Parse(args); err != nil {
			return nil, err
		}
		rest := fl.Args()
		if len(rest) == 0 {
			break
		}
		if len(args) > len(rest) && args[len(args)-len(rest)-1] == "--" {
			pos = append(pos, rest...)
			break
		}
		pos, args = append(pos, rest[0]), rest[1:]
	}
	if len(pos) != npos {
		return nil, fmt.Errorf("%s takes %d argument(s), got %d (see shelf help)", fl.Name(), npos, len(pos))
	}
	return pos, nil
}

func setFlags(fl *flag.FlagSet) map[string]bool {
	m := map[string]bool{}
	fl.Visit(func(f *flag.Flag) { m[f.Name] = true })
	return m
}

// password reads --password or --password-stdin (one line); ok is false when neither is given.
func password(fl *flag.FlagSet) (pw string, ok bool, err error) {
	fromStdin := fl.Lookup("password-stdin").Value.String() == "true"
	given := setFlags(fl)["password"]
	switch {
	case given && fromStdin:
		return "", false, errors.New("use --password or --password-stdin, not both")
	case given:
		return fl.Lookup("password").Value.String(), true, nil
	case fromStdin:
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			return "", false, fmt.Errorf("no password on stdin: %v", err)
		}
		return line, true, nil
	}
	return "", false, nil
}

func expiresValue(s string) any {
	if s == "never" {
		return nil
	}
	return s
}

func printRaw(b []byte) error {
	if len(b) == 0 || b[len(b)-1] != '\n' {
		b = append(b, '\n')
	}
	_, err := os.Stdout.Write(b)
	return err
}

// --- config and HTTP ---

type config struct {
	URL string `json:"url"`
	Key string `json:"key"`
}

func configDir() (string, error) {
	d, err := os.UserConfigDir()
	return filepath.Join(d, "shelf"), err
}

func loadConfig() (config, error) {
	var c config
	if dir, err := configDir(); err == nil {
		b, err := os.ReadFile(filepath.Join(dir, "config.json"))
		if err == nil {
			if err := json.Unmarshal(b, &c); err != nil {
				return c, fmt.Errorf("bad config file: %w", err)
			}
		} else if !errors.Is(err, fs.ErrNotExist) {
			return c, err
		}
	}
	c.URL = strings.TrimRight(c.URL, "/")
	envKey := os.Getenv("SHELF_KEY")
	if v := strings.TrimRight(os.Getenv("SHELF_URL"), "/"); v != "" {
		// The saved key belongs to the saved server; never send it to another one.
		if v != c.URL && c.Key != "" && envKey == "" {
			return c, fmt.Errorf("SHELF_URL (%s) differs from the shelf you logged in to (%s); set SHELF_KEY for it too, or unset SHELF_URL", v, c.URL)
		}
		c.URL = v
	}
	if envKey != "" {
		c.Key = envKey
	}
	if c.URL == "" || c.Key == "" {
		return c, errors.New("not logged in: run shelf login, or set SHELF_URL and SHELF_KEY")
	}
	return c, nil
}

// writeAtomic writes a 0600 file through a temp file and rename, so readers never see half of it.
func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(f.Name(), path)
	}
	if err != nil {
		os.Remove(f.Name())
	}
	return err
}

type httpError struct {
	msg  string
	code int
}

func (e *httpError) Error() string { return fmt.Sprintf("%s (HTTP %d)", e.msg, e.code) }

func checkResp(resp *http.Response) error {
	if resp.StatusCode < 300 {
		return nil
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	msg := http.StatusText(resp.StatusCode)
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(b, &e) == nil && e.Error != "" {
		msg = e.Error
	} else if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/plain") && len(bytes.TrimSpace(b)) > 0 {
		msg = string(bytes.TrimSpace(b))
	}
	return &httpError{clean(msg), resp.StatusCode}
}

// clean replaces control characters in a server-supplied string so it can't drive the terminal (ESC, CSI, OSC).
func clean(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return '\uFFFD'
		}
		return r
	}, s)
}

// client refuses to follow a redirect of a write, which Go would re-send as a GET that looks like success.
// No overall Timeout: it would also cut off large uploads and downloads on slow links.
var client = &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
	if m := via[0].Method; m != "GET" && m != "HEAD" {
		return fmt.Errorf("server redirected to %s; run shelf login with that URL", req.URL)
	}
	// Go copies custom headers to any host; a doc password belongs to the server it was typed for.
	if req.URL.Host != via[0].URL.Host {
		req.Header.Del("X-Doc-Password")
	}
	if len(via) >= 10 {
		return errors.New("stopped after 10 redirects")
	}
	return nil
}}

func send(req *http.Request) ([]byte, error) {
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if err := checkResp(resp); err != nil {
		return nil, err
	}
	return io.ReadAll(resp.Body)
}

func (c config) request(method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequest(method, c.URL+path, body)
	if err == nil {
		req.Header.Set("Authorization", "Bearer "+c.Key)
	}
	return req, err
}

// do sends an API call with an optional JSON body and returns the response body.
func (c config) do(method, path string, body any) ([]byte, error) {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(b)
	}
	req, err := c.request(method, path, r)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return send(req)
}

type doc struct {
	ID        string  `json:"id"`
	Slug      *string `json:"slug"`
	Title     *string `json:"title"`
	Project   *string `json:"project"`
	Locked    bool    `json:"locked"`
	Favorite  bool    `json:"favorite"`
	ExpiresAt *int64  `json:"expiresAt"`
	Latest    int     `json:"latest"`
	UpdatedAt int64   `json:"updatedAt"`
	URL       string  `json:"url"`
	// Push responses only.
	Version    int      `json:"version"`
	VersionURL string   `json:"versionUrl"`
	Created    bool     `json:"created"`
	Missing    []string `json:"missing"`
}

func docPath(ref string) string { return "/api/docs/" + url.PathEscape(ref) }

// --- commands ---

func login(args []string) error {
	if _, err := parse(flag.NewFlagSet("login", flag.ContinueOnError), args, 0); err != nil {
		return err
	}
	in := bufio.NewReader(os.Stdin)
	prompt := func(label string) string {
		fmt.Fprint(os.Stderr, label)
		line, _ := in.ReadString('\n')
		return strings.TrimSpace(line)
	}
	// shortcut: the key echoes while typed; hiding it needs a terminal package outside the standard library.
	c := config{URL: strings.TrimRight(prompt("Server URL: "), "/"), Key: prompt("API key: ")}
	if u, err := url.Parse(c.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("server URL must look like https://shelf.example.com")
	}
	if c.Key == "" {
		return errors.New("API key is empty")
	}
	if _, err := c.do("GET", "/api/docs", nil); err != nil {
		return err
	}
	dir, err := configDir()
	if err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	if err := writeAtomic(filepath.Join(dir, "config.json"), b); err != nil {
		return err
	}
	fmt.Println("logged in to", c.URL)
	return nil
}

func push(args []string) error {
	fl := flag.NewFlagSet("push", flag.ContinueOnError)
	slug := fl.String("slug", "", "")
	fl.String("password", "", "")
	fl.Bool("password-stdin", false, "")
	expires := fl.String("expires", "", "")
	title := fl.String("title", "", "")
	project := fl.String("project", "", "")
	msg := fl.String("m", "", "")
	isNew := fl.Bool("new", false, "")
	asJSON := fl.Bool("json", false, "")
	pos, err := parse(fl, args, 1)
	if err != nil {
		return err
	}
	c, err := loadConfig()
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(pos[0])
	if err != nil {
		return err
	}
	files, isDir, err := manifest(abs)
	if err != nil {
		return err
	}

	given := setFlags(fl)
	body := map[string]any{"files": files}
	if given["slug"] {
		body["slug"] = *slug
	}
	if pw, ok, err := password(fl); err != nil {
		return err
	} else if ok {
		body["password"] = pw
	}
	if given["expires"] {
		body["expires"] = expiresValue(*expires)
	}
	if given["title"] {
		body["title"] = *title
	}
	if given["project"] {
		body["project"] = *project
	}
	if given["m"] {
		body["message"] = *msg
	}

	mapPath, err := mappingPath(c.URL, abs)
	if err != nil {
		return err
	}
	if !*isNew && !given["slug"] {
		var m struct{ ID string }
		if b, err := os.ReadFile(mapPath); err == nil && json.Unmarshal(b, &m) == nil && m.ID != "" {
			body["ref"] = m.ID
		}
	}

	var raw []byte
	var d doc
	for {
		if body["ref"] == nil && isDir && !given["title"] {
			body["title"] = filepath.Base(abs)
		}
		raw, d, err = pushManifest(c, body, files)
		// The mapped doc was deleted on the server: forget it and push as a new doc.
		var he *httpError
		if body["ref"] != nil && errors.As(err, &he) && he.code == http.StatusNotFound {
			os.Remove(mapPath)
			delete(body, "ref")
			continue
		}
		break
	}
	if err != nil {
		return err
	}
	m, _ := json.Marshal(struct {
		URL  string `json:"url"`
		Path string `json:"path"`
		ID   string `json:"id"`
	}{c.URL, abs, d.ID})
	// The doc is already published: a failed mapping write must not hide the receipt and invite a duplicate retry.
	if err := writeAtomic(mapPath, m); err != nil {
		fmt.Fprintf(os.Stderr, "shelf: warning: could not save the local doc mapping (%v); the next push of this path may make a new doc\n", err)
	}

	if *asJSON {
		return printRaw(raw)
	}
	fmt.Println(clean(d.URL))
	if d.Created {
		fmt.Printf("version %d\n", d.Version)
	} else {
		fmt.Printf("version %d (unchanged)\n", d.Version)
	}
	fmt.Println("pinned:", clean(d.VersionURL))
	return nil
}

func ls(args []string) error {
	fl := flag.NewFlagSet("ls", flag.ContinueOnError)
	project := fl.String("project", "", "")
	asJSON := fl.Bool("json", false, "")
	if _, err := parse(fl, args, 0); err != nil {
		return err
	}
	c, err := loadConfig()
	if err != nil {
		return err
	}
	path := "/api/docs"
	if *project != "" {
		path += "?project=" + url.QueryEscape(*project)
	}
	raw, err := c.do("GET", path, nil)
	if err != nil {
		return err
	}
	if *asJSON {
		return printRaw(raw)
	}
	var docs []doc
	if err := json.Unmarshal(raw, &docs); err != nil {
		return err
	}
	const layout = "2006-01-02 15:04"
	mark := func(on bool, s string) string {
		if on {
			return s
		}
		return ""
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "\t\tREF\tVERSION\tUPDATED\tEXPIRES\tPROJECT\tTITLE")
	for _, d := range docs {
		ref, exp, proj, title := d.ID, "-", "-", "-"
		if d.Slug != nil {
			ref = *d.Slug
		}
		if d.ExpiresAt != nil {
			exp = time.UnixMilli(*d.ExpiresAt).Format(layout)
		}
		if d.Project != nil {
			proj = *d.Project
		}
		if d.Title != nil {
			title = *d.Title
		}
		// The lock emoji is two columns wide but one rune; VS16 makes tabwriter count it as two.
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\t%s\t%s\t%s\n", mark(d.Favorite, "★"), mark(d.Locked, "🔒\ufe0f"), clean(ref), d.Latest,
			time.UnixMilli(d.UpdatedAt).Format(layout), exp, clean(proj), clean(title))
	}
	return tw.Flush()
}

func set(args []string) error {
	fl := flag.NewFlagSet("set", flag.ContinueOnError)
	slug := fl.String("slug", "", "")
	noSlug := fl.Bool("no-slug", false, "")
	fl.String("password", "", "")
	fl.Bool("password-stdin", false, "")
	noPassword := fl.Bool("no-password", false, "")
	expires := fl.String("expires", "", "")
	title := fl.String("title", "", "")
	project := fl.String("project", "", "")
	fav := fl.Bool("fav", false, "")
	unfav := fl.Bool("unfav", false, "")
	asJSON := fl.Bool("json", false, "")
	pos, err := parse(fl, args, 1)
	if err != nil {
		return err
	}
	given := setFlags(fl)
	if given["slug"] && *noSlug || *fav && *unfav {
		return errors.New("conflicting flags: --slug/--no-slug or --fav/--unfav")
	}

	body := map[string]any{}
	if given["slug"] {
		body["slug"] = *slug
	}
	if *noSlug {
		body["slug"] = nil
	}
	pw, ok, err := password(fl)
	if err != nil {
		return err
	}
	if ok && *noPassword {
		return errors.New("conflicting flags: a password and --no-password")
	}
	if ok {
		body["password"] = pw
	}
	if *noPassword {
		body["password"] = nil
	}
	if given["expires"] {
		body["expires"] = expiresValue(*expires)
	}
	if given["title"] {
		body["title"] = *title
	}
	if given["project"] {
		body["project"] = *project
	}
	if *fav || *unfav {
		body["favorite"] = *fav
	}
	if len(body) == 0 {
		return errors.New("nothing to change (see shelf help)")
	}

	c, err := loadConfig()
	if err != nil {
		return err
	}
	raw, err := c.do("PATCH", docPath(pos[0]), body)
	if err != nil {
		return err
	}
	if *asJSON {
		return printRaw(raw)
	}
	var d doc
	if err := json.Unmarshal(raw, &d); err != nil {
		return err
	}
	fmt.Println(clean(d.URL))
	return nil
}

func rm(args []string) error {
	pos, err := parse(flag.NewFlagSet("rm", flag.ContinueOnError), args, 1)
	if err != nil {
		return err
	}
	c, err := loadConfig()
	if err != nil {
		return err
	}
	if _, err := c.do("DELETE", docPath(pos[0]), nil); err != nil {
		return err
	}
	fmt.Println("deleted", pos[0])
	return nil
}

func open(args []string) error {
	pos, err := parse(flag.NewFlagSet("open", flag.ContinueOnError), args, 1)
	if err != nil {
		return err
	}
	c, err := loadConfig()
	if err != nil {
		return err
	}
	raw, err := c.do("GET", docPath(pos[0]), nil)
	if err != nil {
		return err
	}
	var d doc
	if err := json.Unmarshal(raw, &d); err != nil {
		return err
	}
	// The URL goes to the OS opener, which would also run file:, smb: or app-specific handlers.
	if u, err := url.Parse(d.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("refusing to open non-http(s) URL %q", d.URL)
	}
	fmt.Println(clean(d.URL))
	switch runtime.GOOS {
	case "windows":
		return launch("rundll32", "url.dll,FileProtocolHandler", d.URL)
	case "darwin":
		return launch("open", d.URL)
	default:
		return launch("xdg-open", d.URL)
	}
}

// launch starts the OS URL opener; a var so tests can see what would run.
var launch = func(name string, arg ...string) error { return exec.Command(name, arg...).Start() }

func get(args []string) error {
	fl := flag.NewFlagSet("get", flag.ContinueOnError)
	out := fl.String("o", "", "")
	fl.String("password", "", "")
	fl.Bool("password-stdin", false, "")
	pos, err := parse(fl, args, 1)
	if err != nil {
		return err
	}
	u, err := url.Parse(pos[0])
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("not an http(s) URL: %s", pos[0])
	}
	q := u.Query()
	q.Set("raw", "") // Markdown comes back as source, not rendered HTML
	u.RawQuery = q.Encode()
	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return err
	}
	pw, ok, err := password(fl)
	if err != nil {
		return err
	}
	if ok {
		req.Header.Set("X-Doc-Password", pw)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return &httpError{"locked: wrong or missing password (use --password or --password-stdin)", resp.StatusCode}
	}
	if err := checkResp(resp); err != nil {
		return err
	}
	// Folder docs live under a trailing slash (the reader redirects there); the API has no file listing.
	if strings.HasSuffix(resp.Request.URL.Path, "/") {
		return errors.New("this is a folder doc; shelf get only downloads single files")
	}

	name := *out
	if name == "" {
		name = "download"
		if _, params, err := mime.ParseMediaType(resp.Header.Get("Content-Disposition")); err == nil && params["filename"] != "" {
			// Base keeps a hostile server from writing outside the current directory.
			b := filepath.Base(params["filename"])
			// Dotfiles (.npmrc, .envrc) are loaded by other tools on their own, so the server can't pick one; -o can.
			if strings.HasPrefix(b, ".") || strings.ContainsFunc(b, unicode.IsControl) {
				return fmt.Errorf("the server named this file %q; pass -o %q to save it under that name", b, b)
			}
			if b != string(filepath.Separator) {
				name = b
			}
		}
	}
	f, path, err := createUnique(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(path)
		return err
	}
	fmt.Println("saved", path)
	return nil
}

// createUnique creates name, or name-2.ext, name-3.ext... if it exists; it never overwrites.
func createUnique(name string) (*os.File, string, error) {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		p := name
		if i > 1 {
			p = fmt.Sprintf("%s-%d%s", stem, i, ext)
		}
		f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		return f, p, err
	}
}

// --- push internals ---

type file struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	abs    string
	size   int64
}

// manifest hashes one file, or walks a folder: dotfiles and dot-dirs are skipped,
// paths use `/`, and index.html must sit at the top.
func manifest(root string) (files []file, isDir bool, err error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, false, err
	}
	if !info.IsDir() {
		f, err := hashFile(root, filepath.Base(root))
		return []file{f}, false, err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, true, err
	}
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != root && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		// Stat follows symlinks to files; sockets, devices and links to dirs are skipped.
		if info, err := os.Stat(p); err != nil || !info.Mode().IsRegular() {
			return err
		}
		// Links are followed only inside the folder, so a link to ~/.ssh/id_rsa is never uploaded.
		if d.Type()&fs.ModeSymlink != 0 {
			target, err := filepath.EvalSymlinks(p)
			if err != nil {
				return err
			}
			if rel, err := filepath.Rel(realRoot, target); err != nil || !filepath.IsLocal(rel) {
				return fmt.Errorf("%s links outside the folder (to %s); refusing to upload it", p, target)
			}
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		f, err := hashFile(p, filepath.ToSlash(rel))
		files = append(files, f)
		return err
	})
	if err != nil {
		return nil, true, err
	}
	for _, f := range files {
		if f.Path == "index.html" {
			return files, true, nil
		}
	}
	return nil, true, fmt.Errorf("%s has no index.html at its top level; a folder doc needs one", root)
}

func hashFile(abs, path string) (file, error) {
	r, err := os.Open(abs)
	if err != nil {
		return file{}, err
	}
	defer r.Close()
	h := sha256.New()
	n, err := io.Copy(h, r)
	return file{Path: path, SHA256: hex.EncodeToString(h.Sum(nil)), abs: abs, size: n}, err
}

func mappingPath(server, abs string) (string, error) {
	dir, err := configDir()
	sum := sha256.Sum256([]byte(server + "\n" + abs))
	return filepath.Join(dir, "docs", hex.EncodeToString(sum[:])+".json"), err
}

// pushManifest posts the manifest, uploads the blobs the server lacks, and posts again.
func pushManifest(c config, body map[string]any, files []file) ([]byte, doc, error) {
	for attempt := 0; ; attempt++ {
		raw, err := c.do("POST", "/api/push", body)
		if err != nil {
			return nil, doc{}, err
		}
		var d doc
		if err := json.Unmarshal(raw, &d); err != nil {
			return nil, d, fmt.Errorf("bad push response: %w", err)
		}
		if len(d.Missing) == 0 {
			return raw, d, nil
		}
		if attempt > 0 {
			// The server drops a key's older unpushed uploads to fit newer ones, so a push bigger than the quota ends here.
			return nil, d, fmt.Errorf("server still lacks %d file(s) after upload; the files may not fit this key's quota together", len(d.Missing))
		}
		bySHA := map[string]file{}
		for _, f := range files {
			bySHA[f.SHA256] = f
		}
		for _, sha := range d.Missing {
			f, ok := bySHA[sha]
			if !ok {
				return nil, d, fmt.Errorf("server asked for unknown blob %s", sha)
			}
			if err := c.upload(f); err != nil {
				return nil, d, fmt.Errorf("upload %s: %w", f.Path, err)
			}
		}
	}
}

// upload streams one file to PUT /api/blobs/<sha> with its Content-Length.
func (c config) upload(f file) error {
	r, err := os.Open(f.abs)
	if err != nil {
		return err
	}
	defer r.Close()
	req, err := c.request("PUT", "/api/blobs/"+f.SHA256, r)
	if err != nil {
		return err
	}
	req.ContentLength = f.size
	if f.size == 0 {
		req.Body = http.NoBody // Go sends Content-Length: 0 only with NoBody
	}
	_, err = send(req)
	return err
}
