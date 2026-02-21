import { setIcon } from 'obsidian';
import type StoryboardCanvasPlugin from '../../main';
import { SetDateModal } from '../taggingModals';
import { CanvasNode } from '../Canvas';

export function injectCanvasMenuButton(menuEl: HTMLElement, plugin: StoryboardCanvasPlugin) {
  // Check if we are in a canvas view
  const canvas = plugin.canvasManager.getActiveCanvas();
  if (!canvas) return;

  // We only want to enable this if exactly one file node is selected
  const selection = Array.from(canvas.selection);
  if (selection.length !== 1) return;
  
  const targetNode = selection[0] as CanvasNode;
  
  // Note: Obsidian Canvas Nodes usually store the TFile reference in `node.file` directly.
  if (targetNode.getData().type !== 'file' || !targetNode.file) return;

  // Avoid injecting multiple times if menu updates
  if (menuEl.querySelector('.storyboard-menu-btn')) return;

  // Inject a new button next to the standard grouping/color/delete tools
  const btn = document.createElement('button');
  btn.addClass('clickable-icon');
  btn.addClass('canvas-node-menu-item');
  btn.addClass('storyboard-menu-btn');
  btn.setAttribute('aria-label', 'Set story-date');
  setIcon(btn, 'calendar');

  btn.addEventListener('click', () => {
    // Open date modal for this specific node
    new SetDateModal(plugin, targetNode.file!).open();
  });

  menuEl.appendChild(btn);
}
