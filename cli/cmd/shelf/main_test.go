package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode"
)

// testEnv points the CLI at srv with a throwaway config dir and returns that dir.
func testEnv(t *testing.T, srv *httptest.Server) string {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("SHELF_URL", srv.URL)
	t.Setenv("SHELF_KEY", "k")
	return dir
}

// captureStdout runs fn with os.Stdout sent to a temp file and returns what it wrote.
func captureStdout(t *testing.T, fn func() error) (string, error) {
	f, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	old := os.Stdout
	os.Stdout = f
	err = fn()
	os.Stdout = old
	b, _ := os.ReadFile(f.Name())
	return string(b), err
}

func TestRmRefusesRedirect(t *testing.T) {
	var gets int
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "DELETE":
			http.Redirect(w, r, "https://"+r.Host+r.URL.Path, http.StatusMovedPermanently)
		case "GET":
			gets++
			w.Write([]byte(`{}`))
		}
	}))
	defer srv.Close()
	testEnv(t, srv)
	// Trust the test certificate through the transport every client shares by default.
	old := http.DefaultTransport
	http.DefaultTransport = srv.Client().Transport
	t.Cleanup(func() { http.DefaultTransport = old })

	out, err := captureStdout(t, func() error { return rm([]string{"x"}) })
	if err == nil || !strings.Contains(err.Error(), srv.URL+"/api/docs/x") {
		t.Errorf("rm err = %v, want a redirect error naming the Location; stdout %q", err, out)
	}
	if gets != 0 {
		t.Errorf("DELETE was re-sent as %d GET(s)", gets)
	}
}

func TestPushSurvivesMappingWriteFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":"abc","url":"https://s/d/abc","version":1,"versionUrl":"https://s/d/abc/v/1","created":true}`))
	}))
	defer srv.Close()
	dir := testEnv(t, srv)
	// A file where the mapping dir should be makes the write fail, even as root.
	if err := os.MkdirAll(filepath.Join(dir, "shelf"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "shelf", "docs"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	doc := filepath.Join(t.TempDir(), "a.md")
	if err := os.WriteFile(doc, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	out, err := captureStdout(t, func() error { return push([]string{doc}) })
	if err != nil || !strings.Contains(out, "https://s/d/abc\n") || !strings.Contains(out, "pinned: https://s/d/abc/v/1") {
		t.Errorf("push err = %v, stdout %q; want success with the receipt", err, out)
	}
}

func TestManifestRefusesSymlinkOutside(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	secret := filepath.Join(outside, "id_rsa")
	for p, s := range map[string]string{filepath.Join(root, "index.html"): "hi", secret: "SECRET"} {
		if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(secret, filepath.Join(root, "notes.txt")); err != nil {
		t.Fatal(err)
	}
	// A link that stays inside the folder is still followed.
	if err := os.Symlink("index.html", filepath.Join(root, "home.html")); err != nil {
		t.Fatal(err)
	}
	if files, _, err := manifest(root); err == nil || len(files) != 0 {
		t.Errorf("manifest err = %v, files %+v; want an error and no files", err, files)
	}

	if err := os.Remove(filepath.Join(root, "notes.txt")); err != nil {
		t.Fatal(err)
	}
	files, _, err := manifest(root)
	if err != nil || len(files) != 2 {
		t.Errorf("inside link: err = %v, files %+v; want home.html and index.html", err, files)
	}
}

func TestManifest(t *testing.T) {
	root := t.TempDir()
	for _, p := range []string{"index.html", "css/site.css", "sub/deep/page.html", ".env", ".git/config", "sub/.hidden"} {
		p = filepath.Join(root, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(p), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	files, isDir, err := manifest(root)
	if err != nil || !isDir {
		t.Fatalf("manifest: %v, isDir %v", err, isDir)
	}
	var paths []string
	for _, f := range files {
		paths = append(paths, f.Path)
		if len(f.SHA256) != 64 {
			t.Errorf("%s: bad sha %q", f.Path, f.SHA256)
		}
	}
	if want := []string{"css/site.css", "index.html", "sub/deep/page.html"}; !slices.Equal(paths, want) {
		t.Errorf("paths = %q, want %q", paths, want)
	}

	if err := os.Remove(filepath.Join(root, "index.html")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := manifest(root); err == nil {
		t.Error("manifest without index.html: want an error")
	}
}

// saveConfig writes a saved login to a throwaway config dir and clears SHELF_URL and SHELF_KEY.
func saveConfig(t *testing.T, url, key string) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("SHELF_URL", "")
	t.Setenv("SHELF_KEY", "")
	if url == "" {
		return
	}
	cd, err := configDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(filepath.Join(cd, "config.json"), []byte(`{"url":"`+url+`","key":"`+key+`"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestEnvURLAloneKeepsSavedKey(t *testing.T) {
	var auths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auths = append(auths, r.Header.Get("Authorization"))
	}))
	defer srv.Close()
	saveConfig(t, "https://shelf.example", "saved-key")
	t.Setenv("SHELF_URL", srv.URL)

	out, err := captureStdout(t, func() error { return rm([]string{"x"}) })
	if err == nil || !strings.Contains(err.Error(), "set SHELF_KEY") {
		t.Errorf("rm err = %v, want an error asking for SHELF_KEY; stdout %q", err, out)
	}
	if len(auths) != 0 {
		t.Errorf("server at SHELF_URL got %d request(s) with Authorization %q", len(auths), auths)
	}
}

func TestLoadConfigEnv(t *testing.T) {
	for _, tc := range []struct {
		name, savedURL, envURL, envKey string
		want                           config
	}{
		{"same URL, trailing slash", "https://shelf.example", "https://shelf.example/", "", config{"https://shelf.example", "saved-key"}},
		{"both env vars", "https://shelf.example", "https://other.example", "env-key", config{"https://other.example", "env-key"}},
		{"only key", "https://shelf.example", "", "env-key", config{"https://shelf.example", "env-key"}},
		{"no saved config", "", "https://ci.example", "env-key", config{"https://ci.example", "env-key"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			saveConfig(t, tc.savedURL, "saved-key")
			t.Setenv("SHELF_URL", tc.envURL)
			t.Setenv("SHELF_KEY", tc.envKey)
			c, err := loadConfig()
			if err != nil || c != tc.want {
				t.Errorf("loadConfig() = %+v, %v; want %+v", c, err, tc.want)
			}
		})
	}
}

func TestGetRefusesServerChosenDotfile(t *testing.T) {
	name := ".npmrc"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		w.Write([]byte("registry=https://evil.example/"))
	}))
	defer srv.Close()
	t.Chdir(t.TempDir())

	if _, err := captureStdout(t, func() error { return get([]string{srv.URL + "/view/x"}) }); err == nil || !strings.Contains(err.Error(), `-o ".npmrc"`) {
		t.Errorf("get err = %v, want a refusal that names -o", err)
	}
	if _, err := os.Stat(".npmrc"); err == nil {
		t.Error(".npmrc was written to the current directory")
	}
	// -o is the owner's own choice, and an ordinary name still saves as before.
	if _, err := captureStdout(t, func() error { return get([]string{"-o", ".npmrc", srv.URL + "/view/x"}) }); err != nil {
		t.Errorf("get -o .npmrc: %v", err)
	}
	name = "report.pdf"
	if _, err := captureStdout(t, func() error { return get([]string{srv.URL + "/view/x"}) }); err != nil {
		t.Errorf("get report.pdf: %v", err)
	}
	if _, err := os.Stat("report.pdf"); err != nil {
		t.Error(err)
	}
}

func TestGetDropsPasswordOnCrossHostRedirect(t *testing.T) {
	var got []string
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.URL.Path+"="+r.Header.Get("X-Doc-Password"))
		w.Write([]byte("hi"))
	}))
	defer b.Close()
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/same" {
			got = append(got, r.URL.Path+"="+r.Header.Get("X-Doc-Password"))
			w.Write([]byte("hi"))
			return
		}
		target := b.URL + "/other"
		if r.URL.Path == "/to-same" {
			target = "/same"
		}
		http.Redirect(w, r, target, http.StatusFound)
	}))
	defer a.Close()
	t.Chdir(t.TempDir())

	for _, p := range []string{"/to-other", "/to-same"} {
		if _, err := captureStdout(t, func() error { return get([]string{"--password", "s3cret", a.URL + p}) }); err != nil {
			t.Fatalf("get %s: %v", p, err)
		}
	}
	if want := []string{"/other=", "/same=s3cret"}; !slices.Equal(got, want) {
		t.Errorf("password seen as %q, want %q (dropped cross-host, kept same-host)", got, want)
	}
}

func TestOpenRefusesNonHTTPURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":"abc","url":"file:///etc/passwd"}`))
	}))
	defer srv.Close()
	testEnv(t, srv)
	var launched []string
	old := launch
	launch = func(name string, arg ...string) error { launched = append(launched, arg...); return nil }
	t.Cleanup(func() { launch = old })

	_, err := captureStdout(t, func() error { return open([]string{"abc"}) })
	if err == nil || !strings.Contains(err.Error(), "file:///etc/passwd") {
		t.Errorf("open err = %v, want an error naming the URL", err)
	}
	if launched != nil {
		t.Errorf("launcher called with %q", launched)
	}
}

func TestLsStripsControlChars(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`[{"id":"abc","slug":"s\u001b[1m","project":"p\u009b2J","title":"evil\u001b]0;pwned\u0007\u001b[2J","latest":1,"updatedAt":0}]`))
	}))
	defer srv.Close()
	testEnv(t, srv)

	out, err := captureStdout(t, func() error { return ls(nil) })
	if err != nil {
		t.Fatal(err)
	}
	if i := strings.IndexFunc(out, func(r rune) bool { return r != '\n' && unicode.IsControl(r) }); i >= 0 {
		t.Errorf("ls printed control characters: %q", out)
	}
	if !strings.Contains(out, "evil") {
		t.Errorf("ls output %q lacks the title", out)
	}
}
