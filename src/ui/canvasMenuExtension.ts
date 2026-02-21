import { setIcon } from 'obsidian';
import type StoryboardCanvasPlugin from '../../main';
import { SetDateModal } from '../taggingModals';
import { CanvasNode } from '../Canvas';

let observer: MutationObserver | null = null;

export function installCanvasMenuExtension(plugin: StoryboardCanvasPlugin) {
  console.log('[Storyboard Canvas] installCanvasMenuExtension triggered.. observer flag:', !!observer);
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.hasClass('canvas-node-menu')) {
            // Found the canvas node menu!
            console.log('[Storyboard Canvas] Menu DOM node injected by Obsidian detected!');
            injectMenuButton(node, plugin);
          }
        });
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[Storyboard Canvas] MutationObserver successfully attached to document.body');
}

export function uninstallCanvasMenuExtension() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function injectMenuButton(menuEl: HTMLElement, plugin: StoryboardCanvasPlugin) {
  console.log('[Storyboard Canvas] Attempting to inject Calendar button...');
  // Check if we are in a canvas view
  const canvas = plugin.canvasManager.getActiveCanvas();
  if (!canvas) {
    console.log('[Storyboard Canvas] Aborted injection: No active canvas found.');
    return;
  }

  // We only want to enable this if exactly one file node is selected
  const selection = Array.from(canvas.selection);
  if (selection.length !== 1) {
    console.log(`[Storyboard Canvas] Aborted injection: Selection length is ${selection.length}`);
    return;
  }
  
  const targetNode = selection[0] as CanvasNode;
  
  // Note: Obsidian Canvas Nodes usually store the TFile reference in `node.file` directly.
  if (targetNode.getData().type !== 'file' || !targetNode.file) {
    console.log(`[Storyboard Canvas] Aborted injection: Node is not a file node. Type=${targetNode.getData().type}`);
    return;
  }

  // Avoid injecting multiple times if menu updates
  if (menuEl.querySelector('.storyboard-menu-btn')) {
    console.log('[Storyboard Canvas] Aborted injection: Button already exists in DOM.');
    return;
  }

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
