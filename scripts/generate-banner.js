import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";

const COLORS = {
  black: "#000000",
  white: "#FFFFFF",
};

async function generateBanner(theme) {
  const isDark = theme === "dark";
  const bgColor = isDark ? COLORS.black : COLORS.white;
  const textColor = isDark ? COLORS.white : COLORS.black;

  // We generate the 1200x400 banner
  const canvasWidth = 1200;
  const canvasHeight = 400;

  // Exact target scaling based on ratios from Golden Master
  // title size = round(400 * 0.15234375) = 61px
  const titleFontSize = Math.round(canvasHeight * 0.15234375);
  // tagline size = round(400 * 0.0712890625) = 29px
  const taglineFontSize = Math.round(canvasHeight * 0.0712890625);
  // gap = round(400 * 0.041015625) = 16px
  const gap = Math.round(canvasHeight * 0.041015625);
  // AI left margin = round(400 * 0.0078125) = 3px
  const aiMarginLeft = Math.round(canvasHeight * 0.0078125);

  const interExtraBold = await fs.readFile("./scripts/Inter-ExtraBold.otf");
  const interMedium = await fs.readFile("./scripts/Inter-Medium.otf");
  const interRegular = await fs.readFile("./scripts/Inter-Regular.otf");

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bgColor,
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontFamily: "Inter",
                      fontWeight: 800,
                      fontSize: titleFontSize,
                      lineHeight: 1,
                      letterSpacing: "-0.02em", // Increased letter spacing from -0.04em
                      color: textColor,
                    },
                    children: "Maestro",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      marginTop: gap,
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "center",
                      fontFamily: "Inter",
                      fontWeight: 400, // Thinner weight for "workspaces for"
                      fontSize: taglineFontSize,
                      lineHeight: 1,
                      letterSpacing: "-0.02em",
                      backgroundImage:
                        "linear-gradient(90deg, #22D3EE 0%, #7C83F6 52%, #A855F7 100%)",
                      backgroundClip: "text",
                      color: "transparent",
                    },
                    children: [
                      { type: "span", props: { children: "workspaces for" } },
                      {
                        type: "span",
                        props: {
                          style: {
                            fontWeight: 800,
                            marginLeft: aiMarginLeft,
                          },
                          children: "AI",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: canvasWidth,
      height: canvasHeight,
      fonts: [
        { name: "Inter", data: interExtraBold, weight: 800, style: "normal" },
        { name: "Inter", data: interMedium, weight: 500, style: "normal" },
        { name: "Inter", data: interRegular, weight: 400, style: "normal" },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    background: bgColor,
    fitTo: {
      mode: "width",
      value: canvasWidth * 2, // Export at @2x for Retina screens
    },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  await fs.mkdir("./docs/assets", { recursive: true });
  await fs.writeFile(`./docs/assets/banner-${theme}.png`, pngBuffer);
  console.log(`Successfully generated ${theme} banner at ./docs/assets/banner-${theme}.png`);
}

async function main() {
  await generateBanner("dark");
  await generateBanner("light");
}

main().catch(console.error);
