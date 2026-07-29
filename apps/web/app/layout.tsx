import './styles.css';
import './bundle.css';

export const metadata = {
  title: 'ITR Report Engine',
  description: 'Upload, review and generate ITR, GST and financial verification reports'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
