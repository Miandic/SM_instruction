#!/bin/bash
# Run as root after uploading a source-only archive to the build directory.
set -euo pipefail
archive=$(realpath -e "${1:?Usage: build-release.sh SOURCE.tar.gz RELEASE_ID}")
release_id=${2:?Release ID required}
[[ "$release_id" =~ ^[a-zA-Z0-9._-]+$ ]] || exit 1
build="/opt/sm-instruction/build/$release_id"
release="/opt/sm-instruction/releases/$release_id"
test ! -e "$build"
test ! -e "$release"
install -d -o sm-build -g sm-build "$build"
# The archive is created locally from the explicit source allowlist in DEPLOY.md.
tar --no-same-owner -xzf "$archive" -C "$build"
chown -R sm-build:sm-build "$build"
cd "$build"
runuser -u sm-build -- env CARGO_TARGET_DIR=/opt/sm-instruction/build/target \
    /var/lib/sm-build/.cargo/bin/cargo build --release --locked -j 2
install -d "$release"
install -m 755 /opt/sm-instruction/build/target/release/sm-instruction "$release/sm-instruction"
cp -a static deploy "$release/"
sha256sum "$release/sm-instruction" > "$release/SHA256SUMS"
echo "Built $release; review migrations, then activate with deploy/activate-release.sh"
