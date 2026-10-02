class Maestro < Formula
  desc "Multi-repository workspaces for engineering teams"
  homepage "https://github.com/Th3Mouk/maestro"
  url "https://registry.npmjs.org/@th3mouk/maestro/-/maestro-0.8.0.tgz"
  sha256 "0bad42b6660ccb8932d6a2bd852e9aa535e1c768fcf28091bb15b6c0e7b4639b"
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
