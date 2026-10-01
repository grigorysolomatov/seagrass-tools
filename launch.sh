#!/usr/bin/env bash
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ -e /etc/NIXOS && ${_STITCHER_NIX:-} != 1 ]]; then
 printf -v command 'exec env _STITCHER_NIX=1 %q' "$here/launch.sh"
 for argument in "$@"; do printf -v command '%s %q' "$command" "$argument"; done
 exec nix-shell --extra-experimental-features 'nix-command flakes' "$here/shell.nix" --run "$command"
fi
exec uv run --project "$here" --locked python "$here/server.py" "$@"
