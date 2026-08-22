(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShinyGen12 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var SHINY_ATK_DVS = [2, 3, 6, 7, 10, 11, 14, 15];

  function isShinyDvs(atk, def, spe, spc) {
    if (def !== 10 || spe !== 10 || spc !== 10) return false;
    return SHINY_ATK_DVS.indexOf(atk) !== -1;
  }

  function unpack(word) {
    var w = word & 0xffff;
    return {
      atk: (w >> 12) & 0xf,
      def: (w >> 8) & 0xf,
      spe: (w >> 4) & 0xf,
      spc: w & 0xf
    };
  }

  function isShinyWord(word) {
    var d = unpack(word);
    return isShinyDvs(d.atk, d.def, d.spe, d.spc);
  }

  function pack(atk, def, spe, spc) {
    return (((atk & 0xf) << 12) | ((def & 0xf) << 8) | ((spe & 0xf) << 4) | (spc & 0xf)) & 0xffff;
  }

  function gen1HpDv(atk, def, spe, spc) {
    return ((atk & 1) << 3) | ((def & 1) << 2) | ((spe & 1) << 1) | (spc & 1);
  }

  return {
    SHINY_ATK_DVS: SHINY_ATK_DVS,
    isShinyDvs: isShinyDvs,
    isShinyWord: isShinyWord,
    unpack: unpack,
    pack: pack,
    gen1HpDv: gen1HpDv
  };
});
