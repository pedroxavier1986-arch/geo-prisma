import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title: 'Geo Prisma · ANALITX',
 description: 'Transforme CEPs e cidades da sua planilha em coordenadas geográficas. Uma ferramenta ANALITX.',
 robots: { index: false, follow: false },
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="pt-BR"><body>{children}</body></html>;
}
