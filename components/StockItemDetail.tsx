"use client";

import { useLocale } from "@/components/LocaleProvider";
import { MISSING_VALUE, formatDate, formatDateTime, formatPrice, formatQuantity } from "@/lib/format";
import type { StockItem } from "@/lib/types";

// Présentation de la fiche détaillée d'un article, en LECTURE SEULE.
//
// Structure volontairement décomposée en sections indépendantes, chacune
// produisant une liste de lignes « libellé / valeur » : ajouter une section
// plus tard revient à ajouter une entrée dans `sections`, sans toucher au
// rendu. Une ligne dont la valeur est absente est simplement omise — la fiche
// n'affiche que les champs réellement disponibles, plutôt que des tirets.

interface Ligne {
  label: string;
  valeur: string;
}

interface Section {
  titre: string;
  lignes: Ligne[];
}

function lignesUtiles(lignes: (Ligne | null)[]): Ligne[] {
  return lignes.filter((ligne): ligne is Ligne => ligne !== null && ligne.valeur !== MISSING_VALUE);
}

export default function StockItemDetail({ item }: { item: StockItem }) {
  const { t, locale } = useLocale();

  const sections: Section[] = [
    {
      titre: t("stockDetail.sectionIdentity"),
      lignes: lignesUtiles([
        { label: t("stockDetail.category"), valeur: t(`category.${item.category}`) },
        item.barcode ? { label: t("stockDetail.barcode"), valeur: item.barcode } : null,
        { label: t("stockDetail.status"), valeur: t(`status.${item.status}`) },
      ]),
    },
    {
      titre: t("stockDetail.sectionQuantity"),
      lignes: lignesUtiles([
        { label: t("stockDetail.quantity"), valeur: formatQuantity(t, item.quantity, item.unit) },
        { label: t("stockDetail.location"), valeur: t(`location.${item.location}`) },
      ]),
    },
    {
      // Trois dates de natures différentes, volontairement distinguées :
      //  - « Ajouté le »  : created_at, horodatage technique d'entrée dans
      //    l'application. Absent des articles antérieurs — la ligne disparaît
      //    alors, plutôt que d'afficher une valeur trompeuse.
      //  - « Acheté le »  : purchase_date, date métier saisissable.
      //  - « Modifié le » : updated_at, horodatage technique de dernière
      //    modification, réécrit à chaque changement.
      titre: t("stockDetail.sectionDates"),
      lignes: lignesUtiles([
        { label: t("stockDetail.createdAt"), valeur: formatDate(item.created_at, locale) },
        { label: t("stockDetail.purchaseDate"), valeur: formatDate(item.purchase_date, locale) },
        { label: t("stockDetail.expiryDate"), valeur: formatDate(item.expiry_date, locale) },
        { label: t("stockDetail.updatedAt"), valeur: formatDateTime(item.updated_at, locale) },
      ]),
    },
    {
      titre: t("stockDetail.sectionValue"),
      lignes: lignesUtiles([{ label: t("stockDetail.price"), valeur: formatPrice(item.price) }]),
    },
  ].filter((section) => section.lignes.length > 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold break-words">{item.name}</h1>

      {sections.map((section) => (
        <section
          key={section.titre}
          className="rounded-xl border border-black/10 dark:border-white/10 p-3 space-y-1"
        >
          <h2 className="text-sm font-medium opacity-70">{section.titre}</h2>
          <dl>
            {section.lignes.map((ligne) => (
              <div key={ligne.label} className="flex justify-between gap-3 text-sm py-0.5">
                <dt className="opacity-70">{ligne.label}</dt>
                <dd className="text-right break-words">{ligne.valeur}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
