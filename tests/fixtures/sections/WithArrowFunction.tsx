// Section defined as arrow function
interface Props {
  message: string;
  count: number;
}

const WithArrowFunction = (props: Props) => {
  return (
    <div>
      <p>{props.message}</p>
      <span>{props.count}</span>
    </div>
  );
};

export default WithArrowFunction;
