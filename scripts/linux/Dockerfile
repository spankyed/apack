# The Linux test machine the compiler-runtime, native-fixture and live-watcher suites run on from a Mac:
# the Node version CI pins, a C toolchain and Node headers for the native modules and fixtures, git for the
# specs that ask it, rsync for the runner's copy, and the shared libraries an Electron binary loads.
FROM node:24.22.2-bookworm
RUN npm install --global npm@11.21.1

RUN apt-get update && apt-get install -y --no-install-recommends \
      rsync xvfb xauth \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libasound2 \
      libxss1 libxshmfence1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory '*'

WORKDIR /work
