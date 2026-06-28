#!/usr/bin/env bash

set -euo pipefail

APP_NAME="appsdesktop"
OUTPUT_DIR="${OUTPUT_DIR:-/private/tmp/appsdesktop-ui-verify}"

mkdir -p "$OUTPUT_DIR"

log() {
  printf '[verify-ui] %s\n' "$1"
}

run_osascript() {
  osascript -e "$1"
}

run_osascript_block() {
  osascript "$@"
}

ensure_app_running() {
  log "Checking app availability"

  if [[ "$(run_osascript_block <<'APPLESCRIPT'
tell application "System Events"
  return (exists process "appsdesktop") as text
end tell
APPLESCRIPT
)" != "true" ]]; then
    log "App process not found. Start the app first, then rerun this script."
    exit 1
  fi
}

focus_app() {
  log "Bringing app to the front"

  run_osascript_block <<'APPLESCRIPT'
tell application "System Events"
  set frontmost of process "appsdesktop" to true
end tell
APPLESCRIPT

  sleep 1
}

window_rect() {
  run_osascript_block <<'APPLESCRIPT'
tell application "System Events"
  tell process "appsdesktop"
    set {windowPosition, windowSize} to {position, size} of window 1
    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)
  end tell
end tell
APPLESCRIPT
}

click_relative() {
  local relative_x="$1"
  local relative_y="$2"
  local rect window_x window_y window_width window_height click_x click_y

  rect="$(window_rect)"
  IFS=',' read -r window_x window_y window_width window_height <<<"$rect"

  click_x=$((window_x + (window_width * relative_x / 1000)))
  click_y=$((window_y + (window_height * relative_y / 1000)))

  run_osascript "tell application \"System Events\" to click at {$click_x, $click_y}"
}

capture_window() {
  local target_path="$1"

  screencapture -x -R"$(window_rect)" "$target_path"
}

ensure_project_list_page() {
  log "Checking that the app is on the project list page"

  run_osascript_block <<'APPLESCRIPT' >/dev/null
tell application "System Events"
  tell process "appsdesktop"
    button 1 of group "项目列表" of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window "appsdesktop"
  end tell
end tell
APPLESCRIPT
}

open_first_project() {
  log "Opening the first project card"

  run_osascript_block <<'APPLESCRIPT'
tell application "System Events"
  tell process "appsdesktop"
    set projectCard to button 1 of group "项目列表" of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window "appsdesktop"
    set focused of projectCard to true
  end tell
end tell
APPLESCRIPT

  sleep 1
  run_osascript 'tell application "System Events" to key code 49'
  sleep 2
}

scan_current_project() {
  log "Scanning files for the current project"

  run_osascript_block <<'APPLESCRIPT'
tell application "System Events"
  tell process "appsdesktop"
    perform action "AXPress" of button "扫描文件" of group 2 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window "appsdesktop"
  end tell
end tell
APPLESCRIPT

  sleep 3
}

open_first_file() {
  log "Opening the first file row"

  run_osascript_block <<'APPLESCRIPT'
tell application "System Events"
  tell process "appsdesktop"
    perform action "AXPress" of button 1 of group 6 of group 1 of UI element 1 of scroll area 1 of group 1 of group 1 of window "appsdesktop"
  end tell
end tell
APPLESCRIPT

  sleep 2
}

print_summary() {
  log "Verification summary"
  printf 'project_list_shot=%s\n' "$OUTPUT_DIR/01-project-list.png"
  printf 'project_detail_shot=%s\n' "$OUTPUT_DIR/02-project-detail.png"
  printf 'file_preview_shot=%s\n' "$OUTPUT_DIR/03-file-preview.png"
}

main() {
  ensure_app_running
  focus_app
  ensure_project_list_page
  capture_window "$OUTPUT_DIR/01-project-list.png"
  open_first_project
  scan_current_project
  capture_window "$OUTPUT_DIR/02-project-detail.png"
  open_first_file
  capture_window "$OUTPUT_DIR/03-file-preview.png"
  print_summary
}

main "$@"
