#!/bin/bash
# Stand-in `soffice` for acceptance runs on a machine without LibreOffice: runs the
# real one from the app image, under the limits of deploy/compose.prod.yml.
# Link it as `soffice` in a directory on PATH. HOME is the conversion's temp dir.
real_home=$(eval echo "~$(id -un)")
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
export DOCKER_HOST="${DOCKER_HOST:-unix://$real_home/.docker/run/docker.sock}" DOCKER_CONFIG="$real_home/.docker"
chmod 777 "$HOME"
exec docker run --rm --user 10001:10001 --read-only --tmpfs /tmp:size=256m --cap-drop ALL \
  --security-opt no-new-privileges:true --pids-limit 256 --memory 2g --cpus 2 --network none \
  -e HOME="$HOME" -e LANG=C -v "$HOME:$HOME" -w "$HOME" \
  "${ACCSYS_OFFICE_IMAGE:-accsys-verify-app}" soffice "$@"
