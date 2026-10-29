import logo from "../assets/split-control-logo.svg";

export const APP_NAME = "Split Control";
export const APP_TAGLINE = "Orienteering Graphics";

/** The in-app logo: the Split Control product mark (Figma "In app logo") */
export function BrandIcon({ size = 30 }: { size?: number }) {
  return <img className="brand-icon" src={logo} width={size} height={size} alt="" aria-hidden="true" />;
}

/** Icon, name and tagline as shown in the app headers */
export function BrandMark({ size = 30, tagline = true }: { size?: number; tagline?: boolean }) {
  return (
    <>
      <BrandIcon size={size} />
      <span className="brand-text">
        <span className="brand-name">{APP_NAME}</span>
        {tagline && <span className="brand-tagline">{APP_TAGLINE}</span>}
      </span>
    </>
  );
}
