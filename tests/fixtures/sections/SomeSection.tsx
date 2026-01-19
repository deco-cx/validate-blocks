// A simple section for testing
interface Props {
  heading: string;
  description?: string;
}

export default function SomeSection(props: Props) {
  return (
    <section>
      <h1>{props.heading}</h1>
      <p>{props.description}</p>
    </section>
  );
}
