(function () {
  const wc = window.wc || {};
  const blocksRegistry = wc.wcBlocksRegistry;
  const settingsApi = wc.wcSettings;
  const wp = window.wp || {};
  const element = wp.element;
  const htmlEntities = wp.htmlEntities;

  if (!blocksRegistry || !settingsApi || !element) {
    return;
  }

  const settings = settingsApi.getSetting("htn_hoosat_data", {});
  const decodeEntities = htmlEntities && typeof htmlEntities.decodeEntities === "function"
    ? htmlEntities.decodeEntities
    : function (value) {
        return value;
      };

  const createElement = element.createElement;
  const title = decodeEntities(settings.title || "Hoosat (HTN)");
  const description = decodeEntities(
    settings.description || "Pay with Hoosat (HTN). You will be redirected to complete payment.",
  );
  const supports = settings.supports || ["products"];

  const Label = function () {
    return createElement("span", null, title);
  };

  const Content = function () {
    return createElement("div", null, description);
  };

  blocksRegistry.registerPaymentMethod({
    name: "htn_hoosat",
    paymentMethodId: "htn_hoosat",
    label: createElement(Label, null),
    content: createElement(Content, null),
    edit: createElement(Content, null),
    canMakePayment: function () {
      return !!settings.isAvailable;
    },
    ariaLabel: title,
    supports: {
      features: supports,
    },
  });
})();