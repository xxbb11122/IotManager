// Package main builds the exact Caddy release selected by deploy/Caddy.Dockerfile.
//
// Keeping this tiny module outside Caddy's source checkout is Caddy's documented
// custom-build pattern. It makes the executable's Go build metadata state the
// reviewed Caddy release instead of an unversioned local source pseudo-version.
package main

import (
	_ "time/tzdata"

	caddycmd "github.com/caddyserver/caddy/v2/cmd"
	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
