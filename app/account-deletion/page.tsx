export default function AccountDeletionPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Suppression du compte et des données — FreshStock</h1>
      </div>

      <div className="flex flex-col gap-6 text-sm leading-relaxed opacity-80">
        <section>
          <h2 className="text-base font-semibold">Comment demander la suppression</h2>
          <p className="mt-2">
            Envoyez un email à <span className="font-medium">abdelkrim.bahadi1@gmail.com</span>{" "}
            depuis l&apos;adresse associée à votre compte FreshStock, avec pour objet « Suppression
            de compte FreshStock ». Précisez si vous souhaitez :
          </p>
          <ul className="mt-2 list-disc list-inside space-y-1">
            <li>la suppression complète de votre compte et de toutes vos données, ou</li>
            <li>
              la suppression d&apos;une partie seulement de vos données (par exemple votre historique
              de repas), en gardant votre compte actif.
            </li>
          </ul>
          <p className="mt-2">Votre demande est traitée sous 30 jours maximum.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Données supprimées</h2>
          <p className="mt-2">
            En cas de suppression complète : votre compte (email), votre appartenance au foyer, les
            articles de stock que vous avez ajoutés, votre liste de courses et votre historique de
            repas sont définitivement supprimés de nos serveurs. Aucune donnée n&apos;est conservée
            au-delà de cette demande.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Données stockées uniquement sur votre appareil</h2>
          <p className="mt-2">
            Si vous utilisez FreshStock sans compte, vos données restent uniquement sur votre
            appareil et ne nécessitent aucune demande : il suffit d&apos;effacer les données de
            l&apos;application ou de la désinstaller.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Voir aussi</h2>
          <p className="mt-2">
            Pour plus de détails sur les données collectées, consultez notre{" "}
            <a href="/privacy-policy" className="underline font-medium">
              politique de confidentialité
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
