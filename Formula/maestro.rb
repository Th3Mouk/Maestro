class Maestro < Formula
  desc "Multi-repository workspaces for engineering teams"
  homepage "https://github.com/Th3Mouk/maestro"
  url "https://registry.npmjs.org/@th3mouk/maestro/-/maestro-0.1.4.tgz"
  sha256 "8d2f4e0a56a0ec0cb3c26d6873568ed4d290c7d1ddf94e2e28de283c5db491fa"
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
