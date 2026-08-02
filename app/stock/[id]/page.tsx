"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import StockItemDetail from "@/components/StockItemDetail";
import { getStockItem } from "@/lib/stock";
import type { StockItem } from "@/lib/types";

// Fiche détaillée d'un article du stock, STRICTEMENT EN LECTURE.
//
// Aucune mutation : ni écriture Dexie, ni mise en file de synchronisation, ni
// appel Supabase. Les modifications (péremption, « Consommé », « Jeté »)
// restent sur la liste /stock, qui en porte déjà toute la logique.
//
// `params` est une Promise dans cette version de Next.js ; dans un Client
// Component, on la lit avec l'API `use()` de React (voir
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md).

type Etat = { statut: "chargement" } | { statut: "absent" } | { statut: "trouve"; item: StockItem };

export default function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useLocale();
  const [etat, setEtat] = useState<Etat>({ statut: "chargement" });

  useEffect(() => {
    let annule = false;
    // getStockItem cloisonne déjà la lecture au foyer courant : un article
    // appartenant à un autre foyer local n'est jamais retourné, même si son
    // identifiant est connu.
    void getStockItem(id).then((item) => {
      if (annule) return;
      setEtat(item ? { statut: "trouve", item } : { statut: "absent" });
    });
    return () => {
      annule = true;
    };
  }, [id]);

  const retour = (
    <Link href="/stock" className="inline-block text-sm underline text-accent">
      ← {t("stockDetail.backToStock")}
    </Link>
  );

  if (etat.statut === "chargement") {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {retour}
        <p className="text-sm opacity-60">{t("stockDetail.loading")}</p>
      </div>
    );
  }

  // État propre plutôt qu'une page vide : l'article a pu être consommé, jeté
  // ou supprimé depuis un autre appareil du foyer entre-temps.
  if (etat.statut === "absent") {
    return (
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {retour}
        <p className="text-sm rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-3 py-2">
          {t("stockDetail.notFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {retour}
      <StockItemDetail item={etat.item} />
    </div>
  );
}
