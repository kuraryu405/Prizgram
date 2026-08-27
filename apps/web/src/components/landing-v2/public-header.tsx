import Image from "next/image";
import Link from "next/link";

type PublicHeaderProps = Readonly<{
  actionHref: "/login" | "/register";
  actionLabel: string;
}>;

/**
 * The compact variant of the landing-page navigation used on public routes.
 * Route-specific forms remain the page focus while the entry point retains
 * the same brand treatment as the landing page.
 */
export function PublicHeader({ actionHref, actionLabel }: PublicHeaderProps) {
  return (
    <header className="lp-nav is-scrolled public-header">
      <Link href="/" className="lp-nav-left" aria-label="Prizgram トップ">
        <Image
          src="/brand/prizgram-horizontal.svg"
          alt=""
          width={2103}
          height={748}
          className="lp-nav-logo"
          priority
        />
      </Link>
      <Link href={actionHref} className="lp-nav-cta">
        {actionLabel}
      </Link>
    </header>
  );
}
