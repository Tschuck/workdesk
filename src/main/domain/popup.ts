/**
 * A page asked for a pop-up window (`window.open(url, name, 'width=500,height=600')`) rather than a link that opens somewhere: only an
 * https address, and only when the page gave window features, which is how sign-in and payment pop-ups are opened. A plain `_blank` link has none.
 */
export function isSignInPopup(url: string, features: string): boolean {
  if (!/^https:\/\//i.test(url)) return false
  return /(^|,)\s*(width|height|popup|left|top)\b/i.test(features ?? '')
}
