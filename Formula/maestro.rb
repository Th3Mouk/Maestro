class Maestro < Formula
  desc "Workspaces for AI across versioned, multi-repository, multi-runtime engineering environments"
  homepage "https://github.com/Th3Mouk/maestro"
  url "https://registry.npmjs.org/@th3mouk/maestro/-/maestro-0.1.0.tgz"
  sha256 "561c62cf479dc2540d14479375ff423d0f8b406adaff0ebe426eb9164e6d423e"
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
