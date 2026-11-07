// A narrow synthetic smoke check, not an accessibility or accessible-name audit.
// Flags visible form controls without any native label, aria-label, aria-labelledby or title.
module.exports = async function assertVisibleLabels(page) {
  const missing = await page.locator('input:visible, select:visible, textarea:visible').evaluateAll((elements) =>
    elements.filter((element) =>
      !(element.labels && element.labels.length) &&
      !element.getAttribute('aria-label') &&
      !element.getAttribute('aria-labelledby') &&
      !element.getAttribute('title'),
    ).map((element) => `${element.tagName.toLowerCase()}[type=${element.getAttribute('type') || ''}]`),
  );
  if (missing.length) throw new Error(`Visible form controls lack a label mechanism: ${missing.join(', ')}`);
};
