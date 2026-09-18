class Maestro < Formula
  desc "Multi-repository workspaces for engineering teams"
  homepage "https://github.com/Th3Mouk/maestro"
  url "https://registry.npmjs.org/@th3mouk/maestro/-/maestro-0.5.0.tgz"
  sha256 "d627bdac958dbb3f864f109ef7b2c9650a1bf6e7aac459f265b190ee9f1814f1"
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
