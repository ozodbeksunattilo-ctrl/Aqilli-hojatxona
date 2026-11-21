/**
 * Browser page translators (Chrome / Google Translate) replace text nodes with
 * <font> wrappers behind React's back. React then crashes the whole app with
 * "Failed to execute 'removeChild' on 'Node'" the next time that text changes.
 * These guards turn the crash into a no-op (see facebook/react#11538).
 * Live numbers additionally carry `notranslate`, so they always stay current.
 */
export function installDomGuard() {
  if (typeof Node !== 'function' || !Node.prototype) return;

  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child) as T;
  };

  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return insertBefore.call(this, node, null) as T;
    return insertBefore.call(this, node, ref) as T;
  };
}
