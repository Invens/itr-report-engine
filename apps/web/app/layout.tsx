import './styles.css';

export const metadata = {
  title: 'ITR Report Engine',
  description: 'Upload, review and generate ITR verification reports'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
