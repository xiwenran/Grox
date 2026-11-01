import { useEffect, useState } from "react";
import { Icon } from "../fx/Icon";

/**
 * Round account avatar. Shows the profile image when it loads; if the URL is
 * missing or the image fails (blocked by CSP, expired, offline) it falls back
 * to a soft filled circle with the email's first letter — never the broken
 * "?" image glyph.
 */
export function AccountAvatar({
  imageUrl,
  email,
  size = 32,
  fallbackIcon = "user",
  className = "",
}: {
  imageUrl?: string;
  email?: string;
  size?: number;
  fallbackIcon?: React.ComponentProps<typeof Icon>["name"];
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  const initial = avatarInitial(email);
  const showImage = Boolean(imageUrl) && !failed;
  return (
    <span
      className={`account-avatar inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-high font-medium text-fg2 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : initial ? (
        initial
      ) : (
        <Icon name={fallbackIcon} size={Math.round(size * 0.44)} className="text-dim" />
      )}
    </span>
  );
}

export function avatarInitial(email?: string): string {
  const first = email?.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return first ? first.toLocaleUpperCase() : "";
}
