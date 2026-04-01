class Maestro < Formula
  desc "Git-backed multi-repository workspaces for engineering teams"
  homepage "https://github.com/Th3Mouk/maestro"
  url "https://registry.npmjs.org/@th3mouk/maestro/-/maestro-0.1.2.tgz"
  sha256 "fd14866a47bf1fac8d6203348256388db9d57169dfc28adc15dc6643ed059eaa"
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
