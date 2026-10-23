# Sourced by the npm scripts: puts Homebrew's rustup toolchain on the PATH when cargo is not already there.
if ! command -v cargo >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
    PATH="$(brew --prefix rustup)/bin:$PATH"
    export PATH
fi
