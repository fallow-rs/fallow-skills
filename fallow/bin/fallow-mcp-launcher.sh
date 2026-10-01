#!/usr/bin/env bash
set -euo pipefail

# Start the fallow MCP server for the Claude Code plugin.
#
# The lookup order follows `fallow agent install`: the project install in
# node_modules/.bin first, then fallow-mcp on PATH, then the multicall
# `fallow mcp-server` entry. When no launcher exists, the script prints one
# clear notice on stderr and exits. Claude Code then reports the server as not
# started. The skills and the commit gate continue to work without it.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

if [ -x "$PROJECT_DIR/node_modules/.bin/fallow-mcp" ]; then
  exec "$PROJECT_DIR/node_modules/.bin/fallow-mcp" "$@"
fi

if command -v fallow-mcp >/dev/null 2>&1; then
  exec fallow-mcp "$@"
fi

# The probe must not read stdin. Stdin carries the MCP messages for the
# server that starts below.
if command -v fallow >/dev/null 2>&1 && fallow mcp-server --version </dev/null >/dev/null 2>&1; then
  exec fallow mcp-server "$@"
fi

{
  echo "fallow MCP server: no fallow-mcp launcher found (tried node_modules/.bin, PATH and fallow mcp-server)."
  echo "fallow MCP server: install fallow in the project (npm install -D fallow) or globally (npm install -g fallow), then restart Claude Code."
} >&2
exit 1
