// Liens de recherche externes (pas d'API recette intégrée) : utilisés à la
// fois pour "voir la recette en ligne" d'une suggestion connue, et pour
// proposer 3 idées de recettes quand aucune recette locale ne correspond à
// un produit donné (ex. un article qui va périmer).
export function externalRecipeLinks(query: string): { label: string; url: string }[] {
  const q = encodeURIComponent(query);
  return [
    { label: "Marmiton", url: `https://www.marmiton.org/recettes/recherche.aspx?aqt=${q}` },
    { label: "CuisineAZ", url: `https://www.cuisineaz.com/recherche/${q}` },
    { label: "Google", url: `https://www.google.com/search?q=${q}+recette` },
  ];
}
