class Maestro < Formula
  desc "Multi-repository workspaces for engineering teams"
  homepage "https://github.com/Th3Mouk/maestro"
  url "https://registry.npmjs.org/@th3mouk/maestro/-/maestro-0.1.5.tgz"
  sha256 "0147ce24753fdd3008686c15378538fb0ea2c2004e9c4ed5a12339943981e49b"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match "Usage: maestro", shell_output("#{bin}/maestro --help")
  end
end
