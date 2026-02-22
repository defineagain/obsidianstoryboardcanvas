# Storyboard Canvas for Obsidian

Storyboard Canvas is a powerful tool for writers that transforms Obsidian's native Canvas into a visual timeline for planning your narrative structures. Arrange your scenes chronologically, visually organize multiple plot arcs, define dependencies between events, and draft "top-down" scenes directly onto the storyboard.

## 🚀 Quick Start Guide

### 1. Tagging Your Scenes
Before you can put scenes on the storyboard, they need metadata to tell the plugin where they belong in time and space.

1. Open any Markdown note you want to use as a scene.
2. Open the Obsidian Command Palette (`Cmd/Ctrl + P`).
3. Run **`Storyboard: Set story arc on current note`**: Type an arc lane name (e.g., `Main Plot`, `Anya's Arc`).
4. Run **`Storyboard: Set story date on current note`**: Type the date when this scene occurs (e.g., `2024-05-12`).

*Tip: You can change the "Date Format" in the plugin settings to match fantasy calendars or simple numbers.*

### 2. Building the Storyboard
Once your scenes are tagged:

1. Create a new Obsidian Canvas (`.canvas` file).
2. Drag and drop your tagged notes onto the canvas anywhere.
3. Open the Command Palette and run **`Storyboard: Build storyboard`**.

**What happens next?**
- Your notes instantly snap into a grid. 
- The Horizontal (`X-axis`) represents **Time**.
- The Vertical (`Y-axis`) represents the **Story Arc**.
- The plugin automatically draws chronological arrows connecting sequential scenes within the same arc.
- If your notes contain `[[wikilinks]]` pointing to each other, the plugin draws dotted "cross-link" arrows showing plot connections across different arcs.

## 🎛️ Interactive Tools

### The Storyboard Inspector (Sidebar)
Click the **Clapperboard icon** in Obsidian's left ribbon to open the Inspector in the right sidebar. When you select a note on the canvas, the Inspector reveals its properties:

- **Timeline Nudge Slider**: Drag the slider left or right to physically move the note across the timeline in real-time. The plugin reads the chronological bounds of the adjacent scenes inside the Inspector so you don't drop it into the wrong time!
- **Arc Selection Dropdown**: Quickly switch the note to a different plot arc without typing YAML by hand.
- **Dependencies Manager**: Click `+ Add Dependency` to define strict rules (e.g., "Scene A MUST happen *before* Scene B"). The Inspector mathematically calculates exactly which dates you are allowed to choose based on these dependencies to keep your continuity flawless!



## 🌡️ Tension Heatmaps
Want to visualize the dramatic pacing of your story? 

1. Add `tension: 1` through `10` as a frontmatter property to your notes (e.g., `tension: 8`).
2. Run the **`Build storyboard`** or **`Sync`** command.
3. The nodes on your canvas will glow with custom CSS! Lower tension scenes cool down with a blue glow, while high-tension climax (`10`) scenes pulse with aggressive red borders.

## 🔄 Syncing Canvas Edits back to Notes
You can visually rearrange scenes by hand!

1. Click and drag a note horizontally (to change when it happens) or vertically (to change its arc).
2. Run the **`Storyboard: Sync canvas to notes`** command.
3. The plugin analyzes the new visual positions, recalculates the dates and arcs, and presents a **Diff Modal** confirming the changes before safely writing the new metadata back into your markdown files.

## ▶️ Playback
Want to review your work like a movie? Run `Storyboard: Play storyboard` and the Canvas viewport will automatically pan chronologically through every scene on your timeline. You can adjust the playback speed in the plugin settings.
