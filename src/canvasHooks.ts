import { around } from 'monkey-around';
import { ItemView } from 'obsidian';
import type StoryboardCanvasPlugin from '../main';
import { injectCanvasMenuButton } from './ui/canvasMenuExtension';
import { INSPECTOR_VIEW_TYPE, StoryboardInspectorView } from './ui/StoryboardInspectorView';

import { handleGhostNodeSpawn } from './ghostNodeBuilder';

/**
 * Patches the internal Obsidian Canvas prototype to hook into its component lifecycle.
 * This is vastly superior to DOM MutationObservers or `setInterval` polling.
 */
export function registerCanvasHooks(plugin: StoryboardCanvasPlugin) {
  let patched = false;

  const tryPatch = () => {
    if (patched) return;

    // Grab any open canvas view to get a reference to the prototype
    const canvasView = plugin.app.workspace.getLeavesOfType('canvas')?.[0]?.view as any;
    if (!canvasView || !canvasView.canvas) return;

    const canvasProto = Object.getPrototypeOf(canvasView.canvas);
    if (!canvasProto) return;

    // ─── 0. Hook into Ghost Node Spawning (Shift + DblClick & Shift + RightClick) ───
    if (canvasProto.onDoubleClick) {
        plugin.register(
            around(canvasProto, {
                onDoubleClick: (next: Function) => function(this: any, e: MouseEvent) {
                    if (e.shiftKey) {
                        e.stopPropagation();
                        e.preventDefault();
                        const pos = this.posFromEvt(e);
                        handleGhostNodeSpawn(plugin, this, pos);
                        return; // intercept
                    }
                    return next.call(this, e);
                }
            })
        );
    }
    
    if (canvasProto.onContextMenu) {
        plugin.register(
            around(canvasProto, {
                onContextMenu: (next: Function) => function(this: any, e: MouseEvent) {
                    if (e.shiftKey) {
                        e.stopPropagation();
                        e.preventDefault();
                        const pos = this.posFromEvt(e);
                        handleGhostNodeSpawn(plugin, this, pos);
                        return; // intercept
                    }
                    return next.call(this, e);
                }
            })
        );
    }

    // ─── 1. Hook into Node Selection changes (replaces 300ms Inspector poller) ───
    if (canvasProto.requestSave) {
        plugin.register(
            around(canvasProto, {
                requestSave: (next: Function) => function(this: any, ...args: any[]) {
                    const result = next.call(this, ...args);
                    
                    // --- LAZY PATCH NODE PROTOTYPES ONCE NODES EXIST ---
                    if (!patched) {
                        const anyNode = this.nodes?.values()?.next()?.value;
                        if (anyNode) {
                            const nodeProto = Object.getPrototypeOf(Object.getPrototypeOf(anyNode));
                            if (nodeProto && nodeProto.showMenu) {
                                plugin.register(
                                    around(nodeProto, {
                                        showMenu: (nextMenu: Function) => function(this: any, ...menuArgs: any[]) {
                                            const menuResult = nextMenu.call(this, ...menuArgs);
                                            setTimeout(() => {
                                                const menuEl = document.body.querySelector('.canvas-node-menu') as HTMLElement;
                                                if (menuEl) {
                                                    injectCanvasMenuButton(menuEl, plugin);
                                                }
                                            }, 0);
                                            return menuResult;
                                        }
                                    })
                                );
                                patched = true;
                                plugin.app.workspace.offref(leafEvent);
                            }
                        }
                    }
                    
                    // If the Inspector is open, manually tell it to update 
                    const inspectorLeaves = plugin.app.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE);
                    for (const leaf of inspectorLeaves) {
                        if (leaf.view instanceof StoryboardInspectorView) {
                            leaf.view.pollSelection();
                        }
                    }
                    
                    return result;
                }
            })
        );
    }

    // ─── 2. Global DOM Fallback for Shift+RightClick ───
    // If canvasProto.onContextMenu doesn't exist, we attach a passive listener to the window
    if (!canvasProto.onContextMenu && !(plugin as any)['__globalContextMenuBound']) {
        (plugin as any)['__globalContextMenuBound'] = true;
        plugin.registerDomEvent(window, 'contextmenu', (e: MouseEvent) => {
            if (e.shiftKey) {
                // Find active canvas
                const canvasView = plugin.app.workspace.getLeavesOfType('canvas')?.[0]?.view as any;
                if (canvasView && canvasView.canvas && canvasView.canvas.canvasEl.contains(e.target as Node)) {
                    // Only intercept if they clicked the background, not a specific node
                    if ((e.target as HTMLElement).hasClass('canvas-wrapper')) {
                        e.stopPropagation();
                        e.preventDefault();
                        const pos = canvasView.canvas.posFromEvt(e);
                        handleGhostNodeSpawn(plugin, canvasView.canvas, pos);
                    }
                }
            }
        }, { capture: true });
    }
  };

  // Try immediately, but also wait for the first Canvas leaf to open
  plugin.app.workspace.onLayoutReady(tryPatch);
  const leafEvent = plugin.app.workspace.on('active-leaf-change', tryPatch);
  plugin.registerEvent(leafEvent);
}
