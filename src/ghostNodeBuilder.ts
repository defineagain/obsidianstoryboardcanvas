import { Notice, TFile } from 'obsidian';
import type StoryboardCanvasPlugin from '../main';
import type { Canvas, Position } from './Canvas';
import { getArcFromY, getDateFromX } from './layoutEngine';
import { formatAbstractDate } from './dateFormatter';

export async function handleGhostNodeSpawn(plugin: StoryboardCanvasPlugin, canvas: Canvas, pos: Position) {
  // 1. Extract the current layout and calculate inverse values
  const events = await plugin.canvasManager.extractScenes(canvas);
  
  const targetArc = getArcFromY(pos.y, events, canvas, plugin.settings.layoutConfig);
  const targetDateArray = getDateFromX(pos.x, events, canvas, plugin.settings.layoutConfig);
  const targetDateStr = formatAbstractDate(targetDateArray, plugin.settings.dateSettings);
  
  // 2. Generate a unique filename
  let counter = 1;
  let filename = `Untitled Scene ${counter}.md`;
  let folderPath = '/'; // Default to root, or preferably same folder as canvas file
  
  // Attempt to place it next to the canvas file if possible
  const canvasView = plugin.app.workspace.getLeavesOfType('canvas')[0]?.view as any;
  if (canvasView && canvasView.file) {
      folderPath = canvasView.file.parent.path;
      if (folderPath !== '/') folderPath += '/';
  }
  
  while (plugin.app.vault.getAbstractFileByPath(`${folderPath}${filename}`)) {
      counter++;
      filename = `Untitled Scene ${counter}.md`;
  }
  
  // 3. Construct the Markdown content with frontmatter
  const content = `---
story-arc: "${targetArc}"
story-date: ${targetDateStr}
---

`;
  
  // 4. Create the file in the vault
  try {
      const newFile = await plugin.app.vault.create(`${folderPath}${filename}`, content);
      
      // 5. Spawn the node on the Canvas
      if (canvas.createFileNode) {
          const node = canvas.createFileNode({
              file: newFile,
              pos: pos,
              size: { width: plugin.settings.layoutConfig.nodeWidth, height: plugin.settings.layoutConfig.nodeHeight },
              save: true,
              focus: true
          });
          
          canvas.addNode(node);
          canvas.requestSave();
          
          // Focus the node for immediate renaming
          canvas.deselectAll();
          canvas.selection.add(node);
          canvas.requestSave();
          canvas.zoomToSelection();
          
          new Notice(`Created new scene in '${targetArc}' on ${targetDateStr}`);
      } else {
          new Notice('Error: Canvas API is missing createFileNode.');
      }
      
  } catch (err) {
      console.error("[Storyboard] Ghost Node generation failed:", err);
      new Notice("Failed to create Ghost Node.");
  }
}
