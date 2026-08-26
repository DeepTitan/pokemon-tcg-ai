// @phosphor-icons/react 2.1.10 places its `import` export condition before
// `types`, which TypeScript's Node16 resolver does not follow to index.d.ts.
// Keep the tracker typed without weakening the rest of the project.
declare module '@phosphor-icons/react' {
  import type { ComponentType, SVGProps } from 'react';

  export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
    size?: string | number;
    weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
    mirrored?: boolean;
  }

  type IconComponent = ComponentType<IconProps>;
  export const Aperture: IconComponent;
  export const BookOpenText: IconComponent;
  export const CardsThree: IconComponent;
  export const CaretLeft: IconComponent;
  export const CaretRight: IconComponent;
  export const CheckCircle: IconComponent;
  export const Drop: IconComponent;
  export const Eye: IconComponent;
  export const FunnelSimple: IconComponent;
  export const GearSix: IconComponent;
  export const Hand: IconComponent;
  export const Leaf: IconComponent;
  export const LockKey: IconComponent;
  export const MagnifyingGlass: IconComponent;
  export const Pause: IconComponent;
  export const Play: IconComponent;
  export const ShieldCheck: IconComponent;
  export const SkipBack: IconComponent;
  export const SkipForward: IconComponent;
  export const Sparkle: IconComponent;
  export const Sword: IconComponent;
  export const Trophy: IconComponent;
  export const WifiHigh: IconComponent;
  export const Wrench: IconComponent;
  export const X: IconComponent;
}
