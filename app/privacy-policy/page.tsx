const LAST_UPDATED = "juillet 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Politique de confidentialité</h1>
        <p className="mt-1 text-sm opacity-60">Dernière mise à jour : {LAST_UPDATED}</p>
      </div>

      <div className="flex flex-col gap-6 text-sm leading-relaxed opacity-80">
        <p>
          FreshStock vous aide à suivre votre stock alimentaire et à réduire le gaspillage. Cette
          page explique simplement quelles données sont utilisées et pourquoi.
        </p>

        <section>
          <h2 className="text-base font-semibold">Ce qui reste sur votre appareil</h2>
          <p className="mt-2">
            Par défaut, sans compte, toutes vos données (stock, menus cuisinés, liste de courses,
            budget) sont stockées uniquement sur votre appareil, dans le stockage local du
            navigateur. Rien n&apos;est envoyé sur un serveur tant que vous n&apos;avez pas créé de
            compte.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Si vous créez un compte</h2>
          <p className="mt-2">
            Créer un compte permet de partager votre stock avec les membres de votre foyer. Nous
            utilisons Supabase (hébergeur tiers de base de données et d&apos;authentification) pour
            stocker :
          </p>
          <ul className="mt-2 list-disc list-inside space-y-1">
            <li>votre adresse email, utilisée uniquement pour l&apos;authentification ;</li>
            <li>le nom de votre foyer et son code d&apos;invitation ;</li>
            <li>
              les articles de votre stock (nom, catégorie, quantité, date de péremption, et prix si
              vous choisissez de le renseigner) ;
            </li>
            <li>votre liste de courses et l&apos;historique des repas préparés dans l&apos;app.</li>
          </ul>
          <p className="mt-2">
            Ces données ne sont visibles que par vous et les membres de votre foyer — jamais par
            d&apos;autres utilisateurs de l&apos;application.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Recherche de produit par code-barres</h2>
          <p className="mt-2">
            Quand vous scannez un code-barres, ce code est envoyé à Open Food Facts
            (openfoodfacts.org), une base de données ouverte et gratuite, pour retrouver le nom et
            la catégorie du produit. Aucune autre information vous concernant n&apos;est transmise à
            ce service.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Pas de publicité, pas de traceurs</h2>
          <p className="mt-2">
            FreshStock n&apos;intègre aucun outil d&apos;analyse publicitaire, aucun traceur, et ne
            vend ni ne partage vos données avec des tiers à des fins commerciales.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Suppression de vos données</h2>
          <p className="mt-2">
            Vous pouvez supprimer chaque article de votre stock ou de votre liste de courses
            directement dans l&apos;application. Pour supprimer entièrement votre compte et les
            données associées, contactez-nous à l&apos;adresse ci-dessous.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">Contact</h2>
          <p className="mt-2">
            Des questions sur cette politique ? Écrivez-nous à{" "}
            <span className="font-medium">abdelkrim.bahadi1@gmail.com</span>.
          </p>
        </section>
      </div>
    </main>
  );
}
