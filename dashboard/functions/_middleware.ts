export const onRequest: PagesFunction = async (context) => {
  // Guest mode — all routes are public, no authentication required.
  return context.next();
};
