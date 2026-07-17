# Canvas Split Open

An [Obsidian](https://obsidian.md) plugin that adds a button to Canvas file cards for opening the underlying note in split view, so you can read or edit it without leaving the Canvas.

## Features

- Adds "Open in split" and "Open fullscreen" buttons/menu items to Canvas file and text nodes.
- Smart split reuse: prefers an existing split over creating a new one every time.
- Configurable split direction (vertical or horizontal) and whether opening a file creates a new tab.
- Works with both file nodes and text nodes (text nodes are opened via a temporary Markdown file).

## Installation

1. Download the latest release and extract `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/canvas-split-open/`.
2. Reload Obsidian, then enable **Canvas Split Open** under **Settings → Community plugins**.

## Usage

1. Select a file node or text node on a Canvas.
2. Either:
   - Right-click the node and choose **Open in split** (or **Open fullscreen**, file nodes only), or
   - Click the split or fullscreen icon in the card's hover menu.

Open the plugin settings to configure whether existing splits are reused, the default split direction, and whether opening a file in an existing split creates a new tab.
