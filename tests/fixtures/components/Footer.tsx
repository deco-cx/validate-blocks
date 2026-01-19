// Footer component for testing path resolution
interface Props {
  copyrightYear: number;
  companyName: string;
}

export default function Footer(props: Props) {
  return (
    <footer>
      &copy; {props.copyrightYear} {props.companyName}
    </footer>
  );
}
