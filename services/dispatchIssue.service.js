const normalizeDispatchIssueItems = (items, fallbackItem) => {
  const rawItems = Array.isArray(items) && items.length > 0
    ? items
    : [fallbackItem];

  return rawItems
    .map((item) => ({
      productId: String(item?.productId || "").trim(),
      novelty: String(item?.novelty || "").trim(),
      presentationType: String(item?.presentationType || "").trim().toLowerCase(),
      quantity: Number(item?.quantity),
    }))
    .filter((item) => item.productId || item.novelty || item.presentationType || Number.isFinite(item.quantity));
};

const hasInvalidDispatchIssueItems = (items) => items.some((item) => {
  if (!item.productId || !item.novelty) {
    return true;
  }

  if (!["caja", "unidad"].includes(item.presentationType)) {
    return true;
  }

  return !Number.isInteger(item.quantity) || item.quantity < 1;
});

module.exports = {
  hasInvalidDispatchIssueItems,
  normalizeDispatchIssueItems,
};