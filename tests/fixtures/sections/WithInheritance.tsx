// Section with interface inheritance
interface BaseProps {
  id: string;
  className?: string;
}

interface ExtendedProps {
  title: string;
  subtitle?: string;
}

interface Props extends BaseProps, ExtendedProps {
  isHighlighted: boolean;
}

export default function WithInheritance(props: Props) {
  return (
    <div id={props.id} className={props.className}>
      <h1>{props.title}</h1>
      <h2>{props.subtitle}</h2>
    </div>
  );
}
