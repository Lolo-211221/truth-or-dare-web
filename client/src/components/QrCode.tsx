import type { ComponentType, CSSProperties } from 'react';
import QRCodeImport from 'react-qr-code';

type QRProps = {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  style?: CSSProperties;
};

/** `react-qr-code` ESM default is sometimes a wrapper `{ QRCode, default }`, not the component. */
const QRCode: ComponentType<QRProps> =
  typeof QRCodeImport === 'function'
    ? (QRCodeImport as unknown as ComponentType<QRProps>)
    : (QRCodeImport as unknown as { QRCode: ComponentType<QRProps> }).QRCode;

/**
 * Room join QR. Value should be the full room URL (e.g. origin + /room/CODE).
 */
export function QrCode(props: QRProps) {
  if (!props.value?.trim()) return null;
  return <QRCode {...props} />;
}
