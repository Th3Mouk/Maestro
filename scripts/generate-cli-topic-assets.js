import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(projectRoot, "docs", "assets");

const COLORS = {
  ink: "#000000",
  white: "#FFFFFF",
  text: "#f8fafc",
  muted: "#94a3b8",
  cyan: "#22d3ee",
  indigo: "#7c83f6",
  violet: "#a855f7",
};

const PROJECT_NAME = "Maestro";
const CATCH_LINE = "Multi-repository workspaces for engineering teams";

async function loadFonts() {
  const interExtraBold = await fs.readFile(path.join(__dirname, "Inter-ExtraBold.otf"));
  const interMedium = await fs.readFile(path.join(__dirname, "Inter-Medium.otf"));
  const interRegular = await fs.readFile(path.join(__dirname, "Inter-Regular.otf"));

  return [
    { name: "Inter", data: interExtraBold, weight: 800, style: "normal" },
    { name: "Inter", data: interMedium, weight: 500, style: "normal" },
    { name: "Inter", data: interRegular, weight: 400, style: "normal" },
  ];
}

function brandBlock({ title, titleSize, subtitleSize, subtitle, gap, width, align = "center" }) {
  return {
    type: "div",
    props: {
      style: {
        width: width ?? "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: "center",
        textAlign: align,
        gap: `${gap}px`,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              fontFamily: "Inter",
              fontSize: `${titleSize}px`,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.08em",
              color: COLORS.text,
            },
            children: title,
          },
        },
        {
          type: "div",
          props: {
            style: {
              fontFamily: "Inter",
              fontSize: `${subtitleSize}px`,
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
              backgroundImage: "linear-gradient(90deg, #22D3EE 0%, #7C83F6 52%, #A855F7 100%)",
              backgroundClip: "text",
              color: "transparent",
              paddingBottom: 8,
            },
            children: subtitle,
          },
        },
      ],
    },
  };
}

function bannerScene() {
  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLORS.ink,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: "1040px",
              height: "220px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
            children: [
              brandBlock({
                title: PROJECT_NAME,
                titleSize: 61,
                subtitleSize: 29,
                gap: 16,
                subtitle: CATCH_LINE,
                width: "100%",
              }),
            ],
          },
        },
      ],
    },
  };
}

function topicScene() {
  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: COLORS.ink,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: "288px",
              height: "288px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
            children: [
              brandBlock({
                title: PROJECT_NAME,
                titleSize: 56,
                subtitleSize: 14,
                gap: 12,
                subtitle: CATCH_LINE,
                width: "236px",
              }),
            ],
          },
        },
      ],
    },
  };
}

async function renderToPng(tree, width, height, outputPath, fonts) {
  const svg = await satori(tree, {
    width,
    height,
    fonts,
  });

  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: width * 2,
    },
  });

  const png = resvg.render().asPng();
  await fs.writeFile(outputPath, png);
}

async function main() {
  const fonts = await loadFonts();
  await fs.mkdir(assetsDir, { recursive: true });

  await renderToPng(bannerScene(), 1200, 400, path.join(assetsDir, "cli-topic-banner.png"), fonts);

  await renderToPng(topicScene(), 288, 288, path.join(assetsDir, "cli-topic.png"), fonts);

  const exploreMirrorDir = path.join(assetsDir, "github-explore", "topics", "cli");
  await fs.mkdir(exploreMirrorDir, { recursive: true });
  await fs.copyFile(path.join(assetsDir, "cli-topic.png"), path.join(exploreMirrorDir, "cli.png"));

  console.log("Generated docs/assets/cli-topic-banner.png");
  console.log("Generated docs/assets/cli-topic.png");
  console.log("Generated docs/assets/github-explore/topics/cli/cli.png");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
