#!/usr/bin/env bash
# Claude Code statusline script.
# Reads JSON session info on stdin and prints a single status line on stdout.
# Wire it up in .claude/settings.json:
#   { "statusLine": { "type": "command", "command": ".claude/statusline.sh" } }

input=$(cat)
model=$(printf '%s' "$input" | sed -n 's/.*"display_name":"\([^"]*\)".*/\1/p')
cwd=$(basename "$PWD")
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ -n "$branch" ]; then
  printf '[%s] %s (%s)' "${model:-claude}" "$cwd" "$branch"
else
  printf '[%s] %s' "${model:-claude}" "$cwd"
fi
