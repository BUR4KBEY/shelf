package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

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
