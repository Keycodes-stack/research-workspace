import Image from "next/image";

const FACES = ["/images/avatar-chelsea.png", "/images/avatar-alan.png"];

/** Overlapping round team photos + optional "+N" counter (Figma "Attendee Avatars"). */
export default function AvatarStack({
  more = 0,
  size = 24,
  faces = FACES,
  label = "Team members",
}: {
  more?: number;
  size?: number;
  faces?: string[];
  label?: string;
}) {
  const overlap = { marginLeft: -Math.round(size * 0.3) };
  return (
    <span className="flex shrink-0 items-center" role="img" aria-label={more ? `${label} (+${more})` : label}>
      {faces.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          width={48}
          height={48}
          className="rounded-full border border-white object-cover"
          style={{ width: size, height: size, ...(i ? overlap : {}) }}
        />
      ))}
      {more > 0 && (
        <span
          className="flex items-center justify-center rounded-full border border-white bg-[#F6F4F3] font-semibold tracking-[-0.04em] text-[#242C2C]"
          style={{ width: size, height: size, fontSize: Math.max(7, size * 0.36), ...overlap }}
        >
          +{more}
        </span>
      )}
    </span>
  );
}
