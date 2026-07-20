document.addEventListener('DOMContentLoaded', function () {
  var buckets = Array.prototype.slice.call(document.querySelectorAll('.bucket'));
  var expandAll = document.getElementById('expandAll');
  var collapseAll = document.getElementById('collapseAll');

  expandAll.addEventListener('click', function () {
    buckets.forEach(function (bucket) { bucket.open = true; });
  });

  collapseAll.addEventListener('click', function () {
    buckets.forEach(function (bucket) { bucket.open = false; });
  });

  document.querySelectorAll('.add-note').forEach(function (button) {
    button.addEventListener('click', function () {
      var content = button.closest('.bucket-content');
      var note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'Working entry placeholder — ready for a source, thought, precedent, or question.';
      content.insertBefore(note, button);
      button.textContent = '+ Add another note';
    });
  });
});
