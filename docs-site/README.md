# lat.md Documentation Site

This directory contains [Quartz](https://quartz.jzhao.xyz/) configuration for publishing the `lat.md/` architecture documentation as a static site with an interactive graph view.

## How it works

The GitHub Actions workflow (`.github/workflows/deploy-docs.yml`) automatically builds and deploys the site to GitHub Pages whenever `lat.md/` files change on the `main` branch.

The site is published at: **https://sttwister.github.io/devbench/**

## Local preview

```bash
# Clone Quartz to a temp directory
git clone --depth 1 https://github.com/jackyzha0/quartz.git /tmp/quartz

# Copy content and config
rm -rf /tmp/quartz/content/*
cp lat.md/*.md /tmp/quartz/content/
mv /tmp/quartz/content/lat.md /tmp/quartz/content/index.md
cp docs-site/quartz.config.ts /tmp/quartz/quartz.config.ts
cp docs-site/quartz.layout.ts /tmp/quartz/quartz.layout.ts

# Install and serve
cd /tmp/quartz && npm install && npx quartz build --serve
```

Then open http://localhost:8080/

## GitHub Pages setup

To enable deployment, go to your GitHub repo → **Settings** → **Pages** → set Source to **GitHub Actions**.
