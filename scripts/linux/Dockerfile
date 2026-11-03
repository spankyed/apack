# The Linux test machine the compiler-runtime, native-fixture and live-watcher suites run on from a Mac:
# the Node version CI pins, a C toolchain and Node headers for the native modules and fixtures, git for the
# specs that ask it, rsync for the runner's copy, the shared libraries an Electron binary loads, and the Rust
# toolchain elmdb pins (its rust-toolchain.toml, which the runner passes as RUST_TOOLCHAIN), to build its binding.
FROM node:23.11.1-bookworm
ARG RUST_TOOLCHAIN
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      rsync xvfb xauth \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libasound2 \
      libxss1 libxshmfence1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory '*' \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST_TOOLCHAIN" -c rustfmt -c clippy

WORKDIR /work
