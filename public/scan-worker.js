// Décodage de code-barres isolé dans un Worker dédié.
//
// Pourquoi : la boucle de scan a été observée figée en continu sur certains
// codes-barres réels (fond sombre, texte dense autour), même après avoir
// écarté un coût CPU excessif et un mauvais traitement des erreurs côté
// thread principal. Si l'algorithme de décodage reste bloqué (boucle interne
// trop longue, voire sans fin, sur une image pathologique), rien côté thread
// principal ne peut l'interrompre — JavaScript y est mono-thread. Un Worker
// peut, lui, être arrêté de force (terminate()) depuis le thread principal,
// qui reste donc toujours réactif et peut relancer une tentative propre au
// prochain cycle au lieu de rester bloqué indéfiniment.
//
// @zxing/library (Apache-2.0) est chargé ici via son build UMD vendorisé
// (public/vendor/zxing-library.min.js, copié depuis node_modules) car ce
// worker est un script classique, sans pipeline de build.
importScripts("/vendor/zxing-library.min.js");

var hints = new Map();
hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
  ZXing.BarcodeFormat.EAN_13,
  ZXing.BarcodeFormat.EAN_8,
  ZXing.BarcodeFormat.UPC_A,
  ZXing.BarcodeFormat.UPC_E,
  ZXing.BarcodeFormat.CODE_128,
  ZXing.BarcodeFormat.CODE_39,
  ZXing.BarcodeFormat.ITF,
]);
var reader = new ZXing.MultiFormatReader();
reader.setHints(hints);

self.onmessage = function (event) {
  var id = event.data.id;
  var gray = event.data.gray;
  var width = event.data.width;
  var height = event.data.height;
  try {
    var luminanceSource = new ZXing.RGBLuminanceSource(gray, width, height);
    var binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminanceSource));
    var result = reader.decodeWithState(binaryBitmap);
    self.postMessage({ id: id, text: result.getText() });
  } catch {
    self.postMessage({ id: id, error: true });
  }
};
